import { defineConfig } from 'drizzle-kit';

try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }

export default defineConfig({
    dialect: 'mysql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
