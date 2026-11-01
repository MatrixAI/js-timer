# AGENTS

- This is a library-js repository. The profile selector is
  [`.matrixai/repo-profile.yml`](.matrixai/repo-profile.yml).
- Use Node.js 24 or newer for development. Publish one ES2022/NodeNext ESM
  artifact for Node, browsers, and workers; do not add platform SDKs or builtins
  to runtime source.
- Source imports are relative. Tests import built modules through the package
  import mapping. Preserve explicit type imports and standard-track decorators.
- Run `npm run lintfix` during development; reserve `npm run lint` for
  non-mutating verification. MatrixAI lint owns formatting across supported
  domains. Do not invoke underlying formatters directly.
- Golden commands: `npm run build`, `npm run typecheck`,
  `npm test -- --runInBand`, `npm run check:package`, `npm run check:portable`,
  `npm run test:browser`, and `npm run check`.
- Keep the Jest/SWC ESM runner, build-first tests, 20-second default timeout,
  and JUnit/coverage artifacts under `tmp/`.
- Documentation is handwritten Markdown. Do not restore TypeDoc or generated API
  documentation, add GitHub Actions, or publish/tag without approval.
- Keep prepared npm archives verbatim: preserve the canonical manifest and
  dependency declarations. Resolve lint producers from the lockfile-selected
  commit, validate their descriptors, and use importNpmLock's matching hook.
- Prefer Git-backed flake refs. Review Git status and stage only exact new flake
  inputs when needed; preserve unrelated index state.
- Run project commands directly in an inherited activated environment. Do not
  load credentials or change persistent shell options during activation.
- Follow the two-space, LF, final-newline editor configuration. Use ASCII prose
  punctuation. Never encode line numbers in repository Markdown link targets.
- Read the standards submodule at `.matrixai/matrixai-standards`: enforce its
  universal hotset, prose rules, and library-js profile, with this repository's
  explicit handwritten-docs override. Refresh it only with authorized access.
- Materialize profile-selected skills after standards updates with
  `nix run './.matrixai/matrixai-standards#skills-materializer' -- --standards-root ./.matrixai/matrixai-standards`.

- Use released Git-tag runtime dependencies and their prepared archives. Browser
  checks must not disguise transitive Node dependencies with aliases.
