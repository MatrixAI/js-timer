import matrixaiConfig from '@matrixai/lint/configs/eslint.js';

/** @type {typeof matrixaiConfig} */
const config = [
  ...matrixaiConfig,
  {
    files: ['src/clock.ts', 'tests/**/*.ts', 'tests/**/*.mjs'],
    languageOptions: { globals: { globalThis: 'readonly' } },
  },
];

export default config;
