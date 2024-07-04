type TimerRef = {
  ref: number | NodeJS.Timer;
  ms?: number;
  type: 'interval' | 'timeout';
  cb: () => void;
};

export type { TimerRef };
