import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
}

/**
 * Creates or retrieves the singleton ioredis connection.
 * Configured specifically for BullMQ compatibility with maxRetriesPerRequest: null.
 */
export function getRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  if (process.env.NODE_ENV === 'production') {
    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }

  if (!globalThis.__redisClient) {
    globalThis.__redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }

  return globalThis.__redisClient;
}

export const redis = getRedisClient();
