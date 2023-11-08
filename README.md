# js-timer

staging:[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-timer/badges/staging/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-timer/commits/staging)
master:[![pipeline status](https://gitlab.com/MatrixAI/open-source/js-timer/badges/master/pipeline.svg)](https://gitlab.com/MatrixAI/open-source/js-timer/commits/master)

This library provides a reified `Timer` replacing the imperative `setTimeout` in JS. This is useful for keeping track of elapsed time and calculating how time is left. Think of this as a "Stopwatch".

This does not use `Date.now()`, it uses `Performance` API.

## Installation

```sh
npm install --save @matrixai/timer
```

## Usage

```ts
import { Timer } from '@matrixai/timer';

const t1 = new Timer(() => 2, 10);
const result = await t1;
```

## Development

Run `nix-shell`, and once you're inside, you can use:

```sh
# install (or reinstall packages from package.json)
npm install
# build the dist
npm run build
# run the repl (this allows you to import from ./src)
npm run tsx
# run the tests
npm run test
# lint the source code
npm run lint
# automatically fix the source
npm run lintfix
```

### Docs Generation

```sh
npm run docs
```

See the docs at: https://matrixai.github.io/js-timer/

### Publishing

Publishing is handled automatically by the staging pipeline.

Prerelease:

```sh
# npm login
npm version prepatch --preid alpha # premajor/preminor/prepatch
git push --follow-tags
```

Release:

```sh
# npm login
npm version patch # major/minor/patch
git push --follow-tags
```

Manually:

```sh
# npm login
npm version patch # major/minor/patch
npm run build
npm publish --access public
git push
git push --tags
```
