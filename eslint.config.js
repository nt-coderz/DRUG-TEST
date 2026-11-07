import securityRules from '@firebase/eslint-plugin-security-rules';

export default [
  {
    files: ['firestore.rules', '*.rules'],
    plugins: {
      '@firebase/security-rules': securityRules,
    },
    languageOptions: {
      parser: securityRules.parser,
    },
    rules: {
      ...securityRules.configs.recommended.rules,
    },
  },
];
