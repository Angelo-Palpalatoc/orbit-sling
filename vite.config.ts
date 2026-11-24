import { defineConfig, type Plugin } from 'vite';

function resolveSiteOrigin(): string {
  const explicit = process.env.SITE_URL || process.env.VITE_SITE_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) {
    return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  return '';
}

function ogAbsoluteUrlPlugin(): Plugin {
  const origin = resolveSiteOrigin();
  return {
    name: 'og-absolute-url',
    transformIndexHtml(html) {
      const ogImageUrl = origin ? `${origin}/og-card.png` : '/og-card.png';
      const ogPageUrl = origin ? `${origin}/` : '/';
      return html
        .replace(/__OG_IMAGE_URL__/g, ogImageUrl)
        .replace(/__OG_PAGE_URL__/g, ogPageUrl);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [ogAbsoluteUrlPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
