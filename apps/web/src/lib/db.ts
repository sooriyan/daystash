import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@repo/core/schema/postgres';

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __drizzleDb: NodePgDatabase<typeof schema> | undefined;
}

/**
 * Creates or retrieves the singleton PostgreSQL connection pool.
 * Uses globalThis in non-production environments to avoid socket leaks during Next.js HMR.
 */
export function getDatabasePool(): pg.Pool {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/daystash';

  if (process.env.NODE_ENV === 'production') {
    return new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  return globalThis.__pgPool;
}

/**
 * Returns the Drizzle ORM instance bound to the PostgreSQL connection pool.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (process.env.NODE_ENV === 'production') {
    return drizzle(getDatabasePool(), { schema });
  }

  if (!globalThis.__drizzleDb) {
    globalThis.__drizzleDb = drizzle(getDatabasePool(), { schema });
  }

  return globalThis.__drizzleDb;
}

export const db = getDb();
export { schema };
