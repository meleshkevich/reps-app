export const ADMIN_IDENTITY = {
  firstName: 'Groupon',
  lastName: 'Admin',
  displayName: 'Groupon Admin',
  email: 'admin@groupon.com',
  role: 'admin',
} as const

export type AdminIdentity = typeof ADMIN_IDENTITY
