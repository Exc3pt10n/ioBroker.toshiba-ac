import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['node_modules/', 'admin/', '*.config.mjs'],
    },
    {
        // Mocha-Tests (Paketprüfung, Integrationstest)
        files: ['test/package.js', 'test/integration.js'],
        languageOptions: {
            globals: { describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly' },
        },
    },
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Kommentare dort, wo sie helfen – nicht an jedem Feld
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            // reines JavaScript ohne Typprüfung: grobe JSDoc-Typen sind ausreichend
            'jsdoc/reject-any-type': 'off',
            'jsdoc/reject-function-type': 'off',
        },
    },
];
