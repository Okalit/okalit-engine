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
fields and methods. `@render` is compiled as a Lit `html` template. Style paths
in the role configuration are imported relative to the `.ok` file. Routes,
services, guards, and interceptors remain regular JavaScript modules.

This alpha does not implement `@if` or `@for` yet. Use standard JavaScript and
Lit expressions in `@render`.

## Compiler API

```js
const { compileOk } = require('@okalit/engine');

const { code } = compileOk(source, { filename: 'counter-page.ok' });
```
