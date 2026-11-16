const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compileOk, parseOk } = require('../src/index.cjs');

test('parses a component role and optional sections', () => {
  const source = `
@component {
  tag: 'my-counter',
  styles: ['counter.scss'],
  props: { count: { type: Number, value: 0 } }
}
@render {
  <p>Count: \${this.count.value}</p>
  <button @click=\${() => this.count.value++}>+1</button>
}
`;
  const result = compileOk(source, { filename: 'my-counter.ok' });

  assert.match(result.code, /class MyCounter extends __Oakalit/);
  assert.match(result.code, /import __okalitStyle0 from "\.\/counter\.scss\?inline"/);
  assert.match(result.code, /render\(\) \{/);
  assert.match(result.code, /tag: 'my-counter'/);
});

test('supports page, module, and main roles with JavaScript imports and logic', () => {
  const source = `
@script {
  import routes from './app.routes.js';
  const appLabel = 'Oakalit';
}
@main {
  tag: 'main-app',
  routes
}
@logic {
  get title() { return appLabel; }
}
`;
  const result = compileOk(source, { filename: 'main-app.ok' });

  assert.match(result.code, /class MainApp extends __AppMixin\(__Oakalit\)/);
  assert.match(result.code, /static config = __okalitConfig/);
  assert.match(result.code, /import routes from '\.\/app\.routes\.js'/);
  assert.match(result.code, /const appLabel = 'Oakalit'/);
  assert.match(result.code, /get title\(\) \{ return appLabel; \}/);

  assert.match(compileOk('@page { tag: "users-page" }', { filename: 'users-page.ok' }).code, /__PageMixin/);
  assert.match(compileOk('@module { tag: "users-module" }', { filename: 'users-module.ok' }).code, /__ModuleMixin/);
});

test('preserves JavaScript strings, comments, and template expressions while finding sections', () => {
  const source = `
@component { tag: 'sample-counter' }
@logic {
  value = '}';
  pattern = /[{}]/;
  get text() { return \`value: \${this.value}\`; }
}
@render {
  <p title="don't close }">${'${this.text}'}</p>
}
`;
  const result = compileOk(source, { filename: 'sample-counter.ok' });
  assert.match(result.code, /pattern = \/\[\{\}\]\//);
  assert.match(result.code, /title="don't close \}"/);
});

test('compiles repeatable template getters and methods with Lit expressions', () => {
  const source = `
@component { tag: 'template-example' }
@template label {
  <span>\${this.label}</span>
}
@template greeting(name, { punctuation = '!' } = {}) {
  <p>\${name + punctuation}</p>
}
@template empty() {
  <b>\${(() => ({ value: this.value }))().value}</b>
}
@template literal {
  <span>\\\${this.isLiteralText}</span>
}
@template résumé {
  <span>Réservé</span>
}
`;
  const result = compileOk(source, { filename: 'template-example.ok' });

  assert.match(result.code, /get label\(\) \{/);
  assert.match(result.code, /greeting\(name, \{ punctuation = '!' \} = \{\}\) \{/);
  assert.match(result.code, /empty\(\) \{/);
  assert.match(result.code, /get résumé\(\) \{/);
  assert.match(result.code, /return __html`[\s\S]*<span>\$\{this\.label\}<\/span>/);
  assert.match(result.code, /<b>\$\{\(\(\) => \(\{ value: this\.value \}\)\)\(\)\.value\}<\/b>/);
  assert.match(result.code, /<span>\\\$\{this\.isLiteralText\}<\/span>/);
});

test('supports templates on every role', () => {
  for (const [role, mixin] of [
    ['component', '__Oakalit'],
    ['page', '__PageMixin'],
    ['module', '__ModuleMixin'],
    ['main', '__AppMixin'],
  ]) {
    const result = compileOk(
      `@${role} { tag: "${role}-template" }\n@template content { <p>Shared template</p>\n}`,
      { filename: `${role}-template.ok` },
    );
    assert.match(result.code, new RegExp(`class ${role[0].toUpperCase()}${role.slice(1)}Template extends ${mixin}`));
    assert.match(result.code, /get content\(\) \{/);
  }
});

test('compiled templates execute as getters and methods and preserve logic branches', async () => {
  const core = `export class Okalit {}
export const html = (strings, ...values) => ({ strings, values });
export const defineElement = () => () => {};
export const PageMixin = Base => class extends Base {};
export const ModuleMixin = Base => class extends Base {};
export const AppMixin = Base => class extends Base {};`;
  const coreUrl = `data:text/javascript;base64,${Buffer.from(core).toString('base64')}`;
  for (const role of ['component', 'page', 'module', 'main']) {
    const source = `@${role} { tag: '${role}-runtime-template' }
@template content {
  <p>\${this.value}</p>
}
@template greeting(name, { punctuation = '!' } = {}) {
  <p>\${name + punctuation}</p>
}
@template empty() {}
@logic {
  value = 1;
  choose(show) { return show ? this.content : this.greeting('Ada'); }
}
@render {
  \${this.choose(true)}
}
`;
    const { code } = compileOk(source, { filename: `${role}-runtime-template.ok` });
    const compiled = code.replace("from '@okalit/core'", `from '${coreUrl}'`);
    const exports = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
    const Component = exports.default;
    const instance = new Component();
    assert.equal(typeof Object.getOwnPropertyDescriptor(Component.prototype, 'content').get, 'function');
    assert.equal(typeof Object.getOwnPropertyDescriptor(Component.prototype, 'greeting').value, 'function');
    assert.equal(typeof Object.getOwnPropertyDescriptor(Component.prototype, 'empty').value, 'function');
    assert.deepEqual(instance.choose(true).values, [1]);
    instance.value = 2;
    assert.deepEqual(instance.content.values, [2]);
    assert.deepEqual(instance.choose(false).values, ['Ada!']);
    assert.deepEqual(instance.greeting('Ada', { punctuation: '?' }).values, ['Ada?']);
    assert.deepEqual(instance.empty().values, []);
    assert.deepEqual(instance.render().values[0].values, [2]);
  }
});

test('parses nested template expressions and template declarations after other sections', () => {
  const source = `
@component { tag: 'nested-template' }
@render { <div>\${this.title}</div>
}
@logic {
  value = '}';
}
@template title() {
  <p title="\${this.value === '}' ? \`value: \${this.value}\` : /[{}]/.source}">Ready</p>
}
`;
  const result = compileOk(source, { filename: 'nested-template.ok' });
  assert.match(result.code, /title\(\) \{/);
  assert.match(result.code, /this\.value === '\}' \? `value: \$\{this\.value\}` : \/\[\{\}\]\/\.source/);
});

test('rejects duplicate templates, logic conflicts, and reserved generated members', () => {
  assert.throws(
    () => parseOk('@component { tag: "duplicate-template" }\n@template title {}\n@template title() {}', 'duplicate-template.ok'),
    /duplicate-template\.ok:3:\d+ Duplicate @template "title"/,
  );
  assert.throws(
    () => compileOk('@component { tag: "logic-conflict" }\n@logic { get title() { return ""; } }\n@template title {}', { filename: 'logic-conflict.ok' }),
    /logic-conflict\.ok:3:\d+ @template "title" conflicts with a member in @logic/,
  );
  assert.throws(
    () => parseOk('@component { tag: "reserved-template" }\n@template render {}', 'reserved-template.ok'),
    /reserved-template\.ok:2:\d+ @template name "render" is reserved/,
  );
  assert.throws(
    () => parseOk('@component { tag: "constructor-template" }\n@template constructor() {}', 'constructor-template.ok'),
    /constructor-template\.ok:2:\d+ @template name "constructor" is reserved/,
  );
});

test('reports malformed template names, parameters, and Lit expressions explicitly', () => {
  assert.throws(
    () => parseOk('@component { tag: "bad-name" }\n@template 1item {}', 'bad-name.ok'),
    /bad-name\.ok:2:\d+ Expected a JavaScript identifier after "@template"/,
  );
  assert.throws(
    () => parseOk('@component { tag: "bad-params" }\n@template item(value = ) {}', 'bad-params.ok'),
    /bad-params\.ok:2:\d+ Invalid @template parameters:/,
  );
  assert.throws(
    () => parseOk('@component { tag: "bad-expression" }\n@template item { <p>\${this.value + }</p>\n}', 'bad-expression.ok'),
    /bad-expression\.ok:2:\d+ Invalid @template expression:/,
  );
  assert.throws(
    () => parseOk('@component { tag: "unclosed-expression" }\n@template item { <p>\${this.value</p>\n}', 'unclosed-expression.ok'),
    /unclosed-expression\.ok:2:\d+ Unclosed @template block/,
  );
});

test('rejects duplicate sections, missing roles, and invalid tags with file locations', () => {
  assert.throws(() => parseOk('@component { tag: "one-item" }\n@component { tag: "two-item" }', 'duplicate.ok'), /duplicate\.ok:2:1 Duplicate section/);
  assert.throws(() => parseOk('@script {}', 'missing-role.ok'), /missing-role\.ok:1:1 Expected exactly one role/);
  assert.throws(() => compileOk('@component { tag: "invalid" }', { filename: 'invalid.ok' }), /invalid\.ok:1:\d+ @component must declare/);
});
