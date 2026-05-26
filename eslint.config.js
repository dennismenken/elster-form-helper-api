// Flat ESLint config (ESLint 9+). Keeps the rule set tight so the codebase
// stays consistent and Open-Source ready without dragging in heavy presets.

import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "src/data/**",
      "vitest.config.ts",
      "scripts/**",
      "*.mjs",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        NodeJS: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs["recommended-type-checked"].rules,
      ...tsPlugin.configs["stylistic-type-checked"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      // Async tool handlers are an interface contract; many don't await
      // because they read from the in-memory catalogue. The async marker
      // documents intent and keeps the call sites uniform.
      "@typescript-eslint/require-await": "off",
      "no-console": ["warn", { allow: ["error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": "error",
    },
  },
  {
    files: ["test/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,mjs}", "eslint.config.js"],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  prettierConfig,
];
