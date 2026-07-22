import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';

import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

// LightBridge is dark-first: honor the OS preference but default to dark.
document.documentElement.dataset.theme = window.matchMedia(
  '(prefers-color-scheme: light)',
).matches
  ? 'light'
  : 'dark';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
