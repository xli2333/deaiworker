/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'report-bg': '#f0f2f5',
        'report-panel': '#ffffff',
        'report-text': '#2d3748',
        'report-accent': '#005f6b',
        'report-accent-light': '#e6fffa',
        'report-secondary': '#4a5568',
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', '"SimSun"', 'Georgia', '"Times New Roman"', 'serif'],
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Hiragino Sans GB"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
      },
    },
  },
  plugins: [],
};
