function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  imap: {
    host: required("IMAP_HOST"),
    port: parseInt(optional("IMAP_PORT", "993")),
    secure: optional("IMAP_TLS", "true") !== "false",
  },
  sieve: {
    host: required("SIEVE_HOST"),
    port: parseInt(optional("SIEVE_PORT", "4190")),
    security: optional("SIEVE_SECURITY", "starttls") as
      | "starttls"
      | "tls"
      | "none",
    scriptName: optional("SIEVE_SCRIPT_NAME", "roundcube"),
  },
  mail: {
    user: required("MAIL_USER"),
    pass: required("MAIL_PASS"),
  },
  pollIntervalSeconds: parseInt(optional("POLL_INTERVAL_SECONDS", "300")),
  graymailFolder: optional("GRAYMAIL_FOLDER", "Graymail"),
  graymailAddFolder: optional("GRAYMAIL_ADD_FOLDER", "Graymail/Add"),
  inboxFolder: optional("INBOX_FOLDER", "INBOX"),
};
