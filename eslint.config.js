import js from '@eslint/js';
import globals from 'globals';

// typescript-eslint does not yet support TypeScript 7 in this environment.
// Keep a lightweight ESLint gate; `tsc --noEmit` remains the type authority.
export default [
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', '**/*.test.ts'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // TS handles these; default ESLint false-positives on type syntax.
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
];
