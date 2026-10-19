export interface SQLiteDatabase {
  execSync: (sql: string) => void;
  runSync: (sql: string, params?: unknown[]) => { changes: number; lastInsertRowId: number };
  getFirstSync: <T>(sql: string, params?: unknown[]) => T | null;
  getAllSync: <T>(sql: string, params?: unknown[]) => T[];
  withTransactionSync: (fn: () => void) => void;
}

export function openDatabaseSync(): SQLiteDatabase {
  return {
    execSync: () => {},
    runSync: () => ({ changes: 1, lastInsertRowId: 1 }),
    getFirstSync: () => null,
    getAllSync: () => [],
    withTransactionSync: (fn: () => void) => {
      fn();
    },
  };
}
