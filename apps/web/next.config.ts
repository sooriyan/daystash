import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@repo/core'],
  serverExternalPackages: ['pg', 'bullmq', 'ioredis'],
};

export default nextConfig;
