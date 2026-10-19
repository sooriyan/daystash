import { z } from 'zod';

/**
 * Validation schema for device registration payload
 */
export const DeviceRegisterInputSchema = z.object({
  userId: z.string().optional(),
  expoPushToken: z
    .string()
    .min(1, 'expoPushToken is required')
    .regex(
      /^(ExponentPushToken\[[A-Za-z0-9_-]+\]|ExpoPushToken\[[A-Za-z0-9_-]+\]|[A-Za-z0-9_-]{32,})$/,
      'Invalid Expo push token format'
    ),
  platform: z.enum(['ios', 'android', 'web']),
});

export type DeviceRegisterInput = z.infer<typeof DeviceRegisterInputSchema>;
