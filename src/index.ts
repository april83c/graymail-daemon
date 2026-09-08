import { ImapFlow } from "imapflow";
import { env } from "./env";
import { SieveClient } from "./sieve-client";
import { updateSieveScript } from "./sieve";

function createImap(): ImapFlow {
  return new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_TLS === "true",
    auth: {
      user: env.MAIL_USER,
      pass: env.MAIL_PASS,
    },
    logger: false,
  });
}

async function collectSenders(
  imap: ImapFlow,
  folder: string,
  destination: string,
): Promise<Set<string>> {
  const senders = new Set<string>();

  const lock = await imap.getMailboxLock(folder);
  try {
    if (!imap.mailbox || imap.mailbox.exists === 0) return senders;

    for await (const msg of imap.fetch("1:*", { envelope: true })) {
      const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
      if (addr) senders.add(addr);
    }

    if (senders.size > 0) {
      await imap.messageMove("1:*", destination);
    }
  } finally {
    lock.release();
  }

  return senders;
}

async function moveMatchingSenders(
  imap: ImapFlow,
  mailbox: string,
  senders: Set<string>,
  destination: string,
): Promise<void> {
  if (senders.size === 0) return;

  const lock = await imap.getMailboxLock(mailbox);
  try {
    for (const sender of senders) {
      const found = await imap.search({ from: sender });
      if (!found || found.length === 0) continue;

      // IMAP SEARCH FROM is a substring match — verify exact address
      const toMove: number[] = [];
      for await (const msg of imap.fetch(found, { envelope: true })) {
        if (msg.envelope?.from?.[0]?.address?.toLowerCase() === sender) {
          toMove.push(msg.uid);
        }
      }

      if (toMove.length > 0) {
        await imap.messageMove(toMove, destination, { uid: true });
        console.log(
          `[tick] Moved ${toMove.length} message(s) from ${sender} in ${mailbox} to ${destination}`,
        );
      }
    }
  } finally {
    lock.release();
  }
}

async function tick(): Promise<void> {
  console.log("[tick] Checking watch folders...");

  const imap = createImap();

  try {
    await imap.connect();

    // Collect senders from both watch folders
    const denySenders = await collectSenders(
      imap,
      env.GRAYMAIL_ADD_FOLDER,
      env.GRAYMAIL_FOLDER,
    );
    const allowSenders = await collectSenders(
      imap,
      env.GRAYMAIL_ALLOW_FOLDER,
      env.INBOX_FOLDER,
    );

    if (denySenders.size === 0 && allowSenders.size === 0) {
      console.log("[tick] Nothing to process");
      await imap.logout();
      return;
    }

    // Allow wins over deny for the same sender
    for (const sender of allowSenders) {
      denySenders.delete(sender);
    }

    if (denySenders.size > 0) {
      console.log(`[tick] Deny: ${[...denySenders].join(", ")}`);
    }
    if (allowSenders.size > 0) {
      console.log(`[tick] Allow: ${[...allowSenders].join(", ")}`);
    }

    // Update sieve script
    const sieve = new SieveClient();
    try {
      await sieve.connect(
        env.SIEVE_HOST,
        env.SIEVE_PORT,
        env.SIEVE_SECURITY,
      );
      await sieve.authenticate(env.MAIL_USER, env.MAIL_PASS);

      const script = await sieve.getScript(env.SIEVE_SCRIPT_NAME);
      const updated = updateSieveScript(
        script,
        {
          graymailAdd: [...denySenders],
          graymailRemove: [...allowSenders],
          allowAdd: [...allowSenders],
        },
        env.GRAYMAIL_FOLDER,
      );

      if (updated !== script) {
        await sieve.putScript(env.SIEVE_SCRIPT_NAME, updated);
        console.log("[tick] Updated sieve script");
      }

      await sieve.logout();
    } catch (err) {
      console.error("[tick] Sieve error:", err);
      sieve.destroy();
    }

    // Move existing messages
    await moveMatchingSenders(
      imap,
      env.INBOX_FOLDER,
      denySenders,
      env.GRAYMAIL_FOLDER,
    );
    await moveMatchingSenders(
      imap,
      env.GRAYMAIL_FOLDER,
      allowSenders,
      env.INBOX_FOLDER,
    );

    await imap.logout();
  } catch (err) {
    console.error("[tick] Error:", err);
    imap.close();
  }
}

async function main(): Promise<void> {
  console.log("graymail-daemon starting");
  console.log(`  IMAP: ${env.IMAP_HOST}:${env.IMAP_PORT}`);
  console.log(`  Sieve: ${env.SIEVE_HOST}:${env.SIEVE_PORT}`);
  console.log(`  Poll interval: ${env.POLL_INTERVAL_SECONDS}s`);
  console.log(`  Watching: ${env.GRAYMAIL_ADD_FOLDER}, ${env.GRAYMAIL_ALLOW_FOLDER}`);

  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("Unhandled error:", err);
    }

    await Bun.sleep(env.POLL_INTERVAL_SECONDS * 1000);
  }
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down");
  process.exit(0);
});

main();
