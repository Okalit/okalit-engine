# @okalit/engine (experimental)

Experimental compiler for `.ok` component files. It runs in Node through the
Rsbuild loader; generated applications still use `@okalit/core` at runtime.

## Initial syntax

A file must contain exactly one role block: `@component`, `@page`, `@module`,
or `@main`. `@script`, `@logic`, and `@render` are optional and can be omitted
when unused.

```text
@script {
  import { signal } from '@okalit/core';

  const initialCount = 0;
}

@page {
  tag: 'counter-page',
  styles: ['counter.scss'],
  props: { count: { type: Number, value: 0 } }
}

@logic {
  clicks = signal(0);
}

@render {
  <button @click=${() => this.clicks.value++}>
    Count: ${this.clicks.value}
  </button>
}
```

`@script` contains ordinary module-scope JavaScript, including imports,
constants, and shared helper functions. `@logic` contains class members such as
fields and methods. `@render` is compiled as the component's `render()` method.
Style paths in the role configuration are imported relative to the `.ok` file.
Routes, services, guards, and interceptors remain regular JavaScript modules.

Repeatable `@template` declarations add Lit template accessors or methods to the
role class:

```text
@template heading {
  <h1>${this.title}</h1>
}

@template itemRow(item, index = 0) {
  <li>${index + 1}. ${item.label}</li>
}

@template emptyState() {
  <p>No items yet.</p>
}
```

`@template name { ... }` compiles to a `get name()` class member;
`@template name(params) { ... }` compiles to a `name(params)` method. The
parentheses are significant: `emptyState()` is a method with no parameters,
whereas `emptyState` is a getter. Parameters use JavaScript function-parameter
syntax, including defaults and destructuring. Template bodies are Lit `html`
template contents, so `${...}` expressions are parsed as JavaScript and
interpolate normally. Each template name must be unique within the file and
must not also be declared as an instance member in `@logic`. `render` and
`constructor` are reserved template names. As with other blocks, put the
closing `}` on its own line; an empty body may use `{}`.

This alpha does not implement `@if` or `@for` yet. Use standard JavaScript and
Lit expressions in `@render`.

## Compiler API

```js
const { compileOk } = require('@okalit/engine');

const { code } = compileOk(source, { filename: 'counter-page.ok' });
```
