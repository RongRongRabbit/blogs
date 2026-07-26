// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Song's Tech Blog",
  tagline: 'AWS・Cloud・Security・Generative AI',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://rongrongrabbit.github.io',
  baseUrl: '/blogs/',

  organizationName: 'rongrongrabbit',
  projectName: 'blogs',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'zh', 'en'],
    localeConfigs: {
      ja: {
        label: '日本語',
        htmlLang: 'ja-JP',
      },
      zh: {
        label: '中文',
        htmlLang: 'zh-CN',
      },
      en: {
        label: 'English',
        htmlLang: 'en',
      },
    },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        // 不使用 Docs
        docs: false,

        blog: {
          showReadingTime: true,

          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },

          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },

        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      metadata: [
        {
          name: 'keywords',
          content:
            'AWS, OCI, Cloud, Security, Generative AI, Automation, Infrastructure',
        },
      ],

      colorMode: {
        respectPrefersColorScheme: true,
      },

      navbar: {
        title: "Song's Tech Blog",

        // 暂时继续使用现有 Logo。
        // 没有自己的 Logo 时，也可以把整个 logo 配置删除。
        logo: {
          alt: "Song's Tech Blog Logo",
          src: 'img/logo.svg',
        },

        items: [
          {
            to: '/blog',
            label: 'Blog',
            position: 'left',
          },
          {
            type: 'localeDropdown',
            position: 'right',
          },
          {
            href: 'https://github.com/rongrongrabbit/blogs',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },

      footer: {
        style: 'dark',

        links: [
          {
            title: 'Contents',
            items: [
              {
                label: 'Blog',
                to: '/blog',
              },
            ],
          },
          {
            title: 'Links',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/rongrongrabbit/blogs',
              },
            ],
          },
        ],

        copyright: `Copyright © ${new Date().getFullYear()} Song's Tech Blog. Built with Docusaurus.`,
      },

      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;