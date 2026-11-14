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

test('rejects duplicate sections, missing roles, and invalid tags with file locations', () => {
  assert.throws(() => parseOk('@component { tag: "one-item" }\n@component { tag: "two-item" }', 'duplicate.ok'), /duplicate\.ok:2:1 Duplicate section/);
  assert.throws(() => parseOk('@script {}', 'missing-role.ok'), /missing-role\.ok:1:1 Expected exactly one role/);
  assert.throws(() => compileOk('@component { tag: "invalid" }', { filename: 'invalid.ok' }), /invalid\.ok:1:\d+ @component must declare/);
});
