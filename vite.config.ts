import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/types.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
})
