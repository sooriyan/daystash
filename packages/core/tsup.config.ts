import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schema/postgres': 'src/schema/postgres.ts',
    'schema/sqlite': 'src/schema/sqlite.ts',
    'validators/sync': 'src/validators/sync.ts',
    'recurrence/rruleEngine': 'src/recurrence/rruleEngine.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
