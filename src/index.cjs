const path = require('node:path');
const { parseExpression } = require('@babel/parser');

const ROLES = new Set(['component', 'page', 'module', 'main']);
const SECTIONS = new Set([...ROLES, 'script', 'logic', 'render']);

function sourceLocation(source, index) {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line, column: index - lineStart + 1 };
}

function syntaxError(source, filename, index, message) {
  const { line, column } = sourceLocation(source, index);
  return new SyntaxError(`${filename}:${line}:${column} ${message}`);
}

function skipWhitespaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close === -1) return index;
      index = close + 2;
      continue;
    }
    break;
  }
  return index;
}

function regexCanStart(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor--;
  if (cursor < 0) return true;

  const previous = source[cursor];
  if ('([{,:;=!?&|+-*%^~<>'.includes(previous)) return true;

  const word = source.slice(0, cursor + 1).match(/[A-Za-z_$][\w$]*$/)?.[0];
  return new Set([
    'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'of',
    'return', 'throw', 'typeof', 'void', 'yield',
  ]).has(word);
}

function skipRegex(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '[') inCharacterClass = true;
    else if (character === ']') inCharacterClass = false;
    else if (character === '/' && !inCharacterClass) {
      index++;
      while (/[A-Za-z]/.test(source[index] || '')) index++;
      return index;
    } else if (character === '\n') {
      break;
    }
    index++;
  }
  return index;
}

function findCodeBlockEnd(source, openBrace, filename) {
  let depth = 1;
  let index = openBrace + 1;
  let mode = 'code';
  const modeStack = [];
  const templateExpressions = [];

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (mode === 'line-comment') {
      if (character === '\n') mode = 'code';
      index++;
      continue;
    }
    if (mode === 'block-comment') {
      if (character === '*' && next === '/') {
        mode = 'code';
        index += 2;
      } else {
        index++;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      if (character === '\\') index += 2;
      else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"')) {
        mode = 'code';
        index++;
      } else {
        index++;
      }
      continue;
    }
    if (mode === 'template') {
      if (character === '\\') {
        index += 2;
      } else if (character === '`') {
        mode = modeStack.pop() || 'code';
        index++;
      } else if (character === '$' && next === '{') {
        depth++;
        templateExpressions.push(1);
        modeStack.push('template');
        mode = 'code';
        index += 2;
      } else {
        index++;
      }
      continue;
    }

    if (character === '/' && next === '/') {
      mode = 'line-comment';
      index += 2;
    } else if (character === '/' && next === '*') {
      mode = 'block-comment';
      index += 2;
    } else if (character === '/' && regexCanStart(source, index)) {
      index = skipRegex(source, index);
    } else if (character === "'") {
      mode = 'single';
      index++;
    } else if (character === '"') {
      mode = 'double';
      index++;
    } else if (character === '`') {
      modeStack.push('code');
      mode = 'template';
      index++;
    } else if (character === '{') {
      depth++;
      if (templateExpressions.length) {
        templateExpressions[templateExpressions.length - 1]++;
      }
      index++;
    } else if (character === '}') {
      depth--;
      if (templateExpressions.length) {
        const expressionDepth = --templateExpressions[templateExpressions.length - 1];
        if (expressionDepth === 0) {
          templateExpressions.pop();
          mode = modeStack.pop();
        }
      }
      if (depth === 0) return index;
      index++;
    } else {
      index++;
    }
  }

  throw syntaxError(source, filename, openBrace, 'Unclosed section block.');
}

function findRenderBlockEnd(source, openBrace, filename) {
  let index = openBrace + 1;
  while (index < source.length) {
    if (source[index] === '$' && source[index + 1] === '{') {
      const expressionOpen = index + 1;
      index = findCodeBlockEnd(source, expressionOpen, filename) + 1;
    } else if (source[index] === '}') {
      const lineStart = source.lastIndexOf('\n', index - 1) + 1;
      const lineEnd = source.indexOf('\n', index + 1);
      const before = source.slice(lineStart, index);
      const after = source.slice(index + 1, lineEnd === -1 ? source.length : lineEnd);
      if (!before.trim() && !after.trim()) return index;
      index++;
    } else {
      index++;
    }
  }
  throw syntaxError(source, filename, openBrace, 'Unclosed @render block.');
}

function parseOk(source, filename = '<input>.ok') {
  const sections = new Map();
  let index = 0;

  while ((index = skipWhitespaceAndComments(source, index)) < source.length) {
    if (source[index] !== '@') {
      throw syntaxError(source, filename, index, 'Expected a top-level @section.');
    }

    const marker = source.slice(index).match(/^@([A-Za-z][A-Za-z0-9_-]*)/);
    if (!marker) throw syntaxError(source, filename, index, 'Invalid section name.');
    const name = marker[1];
    if (!SECTIONS.has(name)) {
      throw syntaxError(source, filename, index, `Unknown section "@${name}".`);
    }
    if (sections.has(name)) {
      throw syntaxError(source, filename, index, `Duplicate section "@${name}".`);
    }

    const markerIndex = index;
    index += marker[0].length;
    while (/\s/.test(source[index] || '')) index++;
    if (source[index] !== '{') {
      throw syntaxError(source, filename, index, `Expected "{" after "@${name}".`);
    }

    const bodyStart = index + 1;
    const bodyEnd = name === 'render'
      ? findRenderBlockEnd(source, index, filename)
      : findCodeBlockEnd(source, index, filename);
    sections.set(name, {
      name,
      body: source.slice(bodyStart, bodyEnd),
      markerIndex,
      bodyStart,
    });
    index = bodyEnd + 1;
  }

  const roles = [...ROLES].filter((role) => sections.has(role));
  if (roles.length !== 1) {
    throw syntaxError(
      source,
      filename,
      0,
      `Expected exactly one role section (@${[...ROLES].join(', @')}); found ${roles.length}.`,
    );
  }

  return { role: roles[0], sections };
}

function parseRoleConfig(section, source, filename) {
  let expression;
  try {
    expression = parseExpression(`({${section.body}})`, {
      sourceType: 'module',
      plugins: ['decorators-legacy'],
    });
  } catch (error) {
    throw syntaxError(
      source,
      filename,
      section.bodyStart + Math.max(0, (error.pos ?? 2) - 2),
      `Invalid @${section.name} configuration: ${error.message}`,
    );
  }

  if (expression.type !== 'ObjectExpression') {
    throw syntaxError(source, filename, section.bodyStart, 'Role configuration must be an object.');
  }

  const tagProperty = expression.properties.find(
    (property) => property.type === 'ObjectProperty' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === 'tag') ||
        (property.key.type === 'StringLiteral' && property.key.value === 'tag')),
  );
  if (tagProperty?.value?.type !== 'StringLiteral' || !tagProperty.value.value.includes('-')) {
    throw syntaxError(
      source,
      filename,
      section.bodyStart + (tagProperty?.start ?? 2) - 2,
      `@${section.name} must declare a custom-element tag containing a hyphen.`,
    );
  }

  const styleProperty = expression.properties.find(
    (property) => property.type === 'ObjectProperty' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === 'styles') ||
        (property.key.type === 'StringLiteral' && property.key.value === 'styles')),
  );
  const styles = [];
  const replacements = [];
  if (styleProperty) {
    if (styleProperty.value.type !== 'ArrayExpression') {
      throw syntaxError(source, filename, section.bodyStart + styleProperty.value.start - 2, 'styles must be an array of file paths.');
    }
    for (const style of styleProperty.value.elements) {
      if (style?.type !== 'StringLiteral') continue;
      const identifier = `__okalitStyle${styles.length}`;
      const relativeSpecifier = /^\.{1,2}\//.test(style.value) || style.value.startsWith('/') || style.value.startsWith('@')
        ? style.value
        : `./${style.value}`;
      const specifier = /\.(css|scss|sass)$/.test(relativeSpecifier)
        ? `${relativeSpecifier}?inline`
        : relativeSpecifier;
      styles.push({ identifier, specifier });
      replacements.push({
        start: style.start - 2,
        end: style.end - 2,
        value: identifier,
      });
    }
  }

  let configBody = section.body;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    configBody = configBody.slice(0, replacement.start) +
      replacement.value +
      configBody.slice(replacement.end);
  }

  return { configBody, styles };
}

function classNameFromFilename(filename) {
  const name = path.basename(filename).replace(/\.ok$/i, '');
  const pascal = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `Oakalit${pascal}`;
}

function compileOk(source, { filename = '<input>.ok', className } = {}) {
  const parsed = parseOk(source, filename);
  const roleSection = parsed.sections.get(parsed.role);
  const { configBody, styles } = parseRoleConfig(roleSection, source, filename);
  const name = className || classNameFromFilename(filename);
  const script = parsed.sections.get('script')?.body || '';
  const logic = parsed.sections.get('logic')?.body || '';
  const render = parsed.sections.get('render')?.body;
  const mixin = {
    component: '__Oakalit',
    page: '__PageMixin(__Oakalit)',
    module: '__ModuleMixin(__Oakalit)',
    main: '__AppMixin(__Oakalit)',
  }[parsed.role];
  const generatedStyles = styles.length
    ? 'styles: __okalitConfig.styles'
    : 'styles: __okalitConfig.styles || []';

  const generated = [
    `import { Okalit as __Oakalit, defineElement as __defineElement, html as __html, PageMixin as __PageMixin, ModuleMixin as __ModuleMixin, AppMixin as __AppMixin } from '@okalit/core';`,
    ...styles.map(({ identifier, specifier }) => `import ${identifier} from ${JSON.stringify(specifier)};`),
    script.trim(),
    `const __okalitConfig = {${configBody}};`,
    `class ${name} extends ${mixin} {`,
    `  static channels = __okalitConfig.channels || {};`,
    ...(parsed.role === 'main' ? ['  static config = __okalitConfig;'] : []),
    logic.trim(),
    ...(render === undefined ? [] : [
      '  render() {',
      `    return __html\`${render}\`;`,
      '  }',
    ]),
    '}',
    `__defineElement({ ...__okalitConfig, ${generatedStyles} })(${name}, {`,
    '  addInitializer(initializer) { initializer.call(' + name + '); },',
    '});',
    `export { ${name} };`,
    `export default ${name};`,
  ].filter((line) => line.length > 0).join('\n');

  try {
    require('@babel/parser').parse(generated, {
      sourceType: 'module',
      plugins: ['classProperties'],
    });
  } catch (error) {
    throw new SyntaxError(`${filename}: generated JavaScript is invalid: ${error.message}`);
  }

  return { code: generated, map: null };
}

module.exports = { compileOk, parseOk };
