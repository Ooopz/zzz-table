// ESLint 9+ 扁平配置：代码质量规则 + 按文件区分 Node/浏览器全局
import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'assets/vendor/**',
      'src/sync/workshop-static.js',
      'package-lock.json',
      'release/**',
    ],
  },
  js.configs.recommended,
  // 关闭与 Prettier 冲突的格式类规则（格式交给 Prettier）
  eslintConfigPrettier,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // 模板字符串里允许全角空格（中文界面用作显示间隔符）
      'no-irregular-whitespace': ['error', { skipTemplates: true }],
    },
  },
  {
    // src/game 单一出口约定：game 外部只准 import game/index.js（barrel），禁止直连内部文件；
    // game 目录内部互引不受限（本规则块的 files 不含 src/game）。
    files: ['server.js', 'src/lib/**/*.js', 'src/web/**/*.js', 'src/sync/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // 命中 …/game/ 或 game 包内除 index.js 外的任何路径（如 ../game/stats.js、./src/game/models.js）
              regex: '(^|/)game(/(?!index\\.js$)|$)',
              message: 'src/game 消费端只准 import game/index.js（barrel 单一出口）。',
            },
          ],
        },
      ],
    },
  },
  {
    // 浏览器端前端模块
    files: ['src/web/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Node 侧：服务器、同步脚本、Node 专属工具、测试
    files: ['server.js', 'src/sync/**/*.js', 'src/lib/nodeUtil.js', 'test/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // 辅助脚本（Node）：scripts/ 下的运维脚本
    files: ['*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // 双端共享模块（Node 与浏览器都可 import，同时提供两边全局）
    files: ['src/lib/util.js', 'src/lib/schema.js', 'src/lib/calc.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
