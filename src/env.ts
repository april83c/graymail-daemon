import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    IMAP_HOST: z.string().min(1),
    IMAP_PORT: z.coerce.number().default(993),
    IMAP_TLS: z.enum(["true", "false"]).default("true"),

    SIEVE_HOST: z.string().min(1),
    SIEVE_PORT: z.coerce.number().default(4190),
    SIEVE_SECURITY: z.enum(["starttls", "tls", "none"]).default("starttls"),
    SIEVE_SCRIPT_NAME: z.string().default("roundcube"),

    MAIL_USER: z.string().min(1),
    MAIL_PASS: z.string().min(1),

    POLL_INTERVAL_SECONDS: z.coerce.number().min(10).default(300),
    GRAYMAIL_FOLDER: z.string().default("Graymail"),
    GRAYMAIL_ADD_FOLDER: z.string().default("Graymail/Add"),
    INBOX_FOLDER: z.string().default("INBOX"),
  },
  runtimeEnv: process.env,
});
