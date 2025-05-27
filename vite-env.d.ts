/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY: string;
  // You can add other environment variables here if your application uses them
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
