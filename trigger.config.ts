import { ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { pythonExtension } from "@trigger.dev/python/extension";
import { defineConfig, timeout } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_iyzrpjtdckzmhtewkadw",
  dirs: ["./lib/trigger"],
  maxDuration: timeout.None, // no max duration
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema/schema.prisma",
      }),
      ffmpeg(),
      pythonExtension({
        scripts: ["./**/*.py"],
      }),
      // Self-host: push runtime env vars to Trigger cloud at deploy time
      syncEnvVars(() =>
        [
          "POSTGRES_PRISMA_URL",
          "POSTGRES_PRISMA_URL_NON_POOLING",
          "DATABASE_URL",
          "BLOB_READ_WRITE_TOKEN",
          "TINYBIRD_TOKEN",
          "TINYBIRD_BASE_URL",
          "NEXT_PUBLIC_UPLOAD_TRANSPORT",
          "NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST",
          "NEXTAUTH_URL",
          "NEXT_PUBLIC_BASE_URL",
          "NEXT_PUBLIC_MARKETING_URL",
          "NEXT_PUBLIC_APP_BASE_HOST",
          "VERCEL_BLOB_HOST",
          "EMAIL_FROM",
          "RESEND_API_KEY",
          "INTERNAL_API_KEY",
        ]
          .filter((name) => !!process.env[name])
          .map((name) => ({ name, value: process.env[name] as string })),
      ),
    ],
  },
});
