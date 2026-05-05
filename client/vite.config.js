import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        terms: resolve(__dirname, 'terms.html'),
        faq: resolve(__dirname, 'faq.html'),
        blog: resolve(__dirname, 'blog.html'),
        'blog-backup-social-media': resolve(__dirname, 'blog-backup-social-media.html'),
        'blog-video-formats': resolve(__dirname, 'blog-video-formats.html'),
        'blog-archive-instagram': resolve(__dirname, 'blog-archive-instagram.html'),
        'blog-tiktok-memories': resolve(__dirname, 'blog-tiktok-memories.html'),
        'blog-digital-hoarding': resolve(__dirname, 'blog-digital-hoarding.html'),
      }
    }
  }
});
