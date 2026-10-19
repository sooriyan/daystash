export interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

const NetInfo = {
  addEventListener: () => () => {},
  fetch: async (): Promise<NetInfoState> => ({
    isConnected: true,
    isInternetReachable: true,
  }),
};

export default NetInfo;
