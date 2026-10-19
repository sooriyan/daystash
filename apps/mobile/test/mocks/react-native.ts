export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};

export type AppStateStatus = 'active' | 'background' | 'inactive';
