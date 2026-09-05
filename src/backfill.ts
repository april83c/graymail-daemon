import { ImapFlow } from "imapflow";
import { env } from "./env";

const dryRun = process.argv.includes("--dry-run");

async function backfill(): Promise<void> {
  console.log(
    `Backfill: scanning ${env.INBOX_FOLDER} for graymail headers${dryRun ? " (dry run)" : ""}...`,
  );

  const imap = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_TLS === "true",
    auth: {
      user: env.MAIL_USER,
      pass: env.MAIL_PASS,
    },
    logger: false,
  });

  await imap.connect();

  try {
    await imap.mailboxCreate(env.GRAYMAIL_FOLDER);
  } catch {
    // already exists
  }

  const lock = await imap.getMailboxLock(env.INBOX_FOLDER);
  try {
    if (!imap.mailbox || imap.mailbox.exists === 0) {
      console.log("Backfill: inbox is empty");
      return;
    }

    console.log(
      `Backfill: ${imap.mailbox.exists} total message(s) in ${env.INBOX_FOLDER}`,
    );

    const results = await imap.search({
      or: [
        { header: { "List-Unsubscribe": "" } },
        { header: { "Auto-Submitted": "" } },
        { header: { Precedence: "bulk" } },
        { header: { Precedence: "list" } },
        { header: { Precedence: "junk" } },
      ],
    });

    if (!results || results.length === 0) {
      console.log("Backfill: no matching messages found");
      return;
    }

    console.log(
      `Backfill: found ${results.length} message(s) matching graymail headers`,
    );

    if (dryRun) {
      console.log("Backfill: dry run, no messages moved");
      return;
    }

    await imap.messageMove(results, env.GRAYMAIL_FOLDER);
    console.log(
      `Backfill: moved ${results.length} message(s) to ${env.GRAYMAIL_FOLDER}`,
    );
  } finally {
    lock.release();
  }

  await imap.logout();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
