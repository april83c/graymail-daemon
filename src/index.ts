import { ImapFlow } from "imapflow";
import { env } from "./env";
import { SieveClient } from "./sieve-client";
import { updateSieveScript } from "./sieve";

async function tick(): Promise<void> {
  console.log("[tick] Checking for new graymail senders...");

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

  try {
    await imap.connect();

    const senders = new Set<string>();

    let lock = await imap.getMailboxLock(env.GRAYMAIL_ADD_FOLDER);
    try {
      if (!imap.mailbox || imap.mailbox.exists === 0) {
        console.log("[tick] No messages in Graymail/Add");
        return;
      }

      for await (const msg of imap.fetch("1:*", { envelope: true })) {
        const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        if (addr) senders.add(addr);
      }

      if (senders.size === 0) {
        console.log("[tick] No valid senders found");
        return;
      }

      console.log(
        `[tick] Found ${senders.size} sender(s): ${[...senders].join(", ")}`,
      );

      await imap.messageMove("1:*", env.GRAYMAIL_FOLDER);
      console.log("[tick] Moved messages from Graymail/Add to Graymail");
    } finally {
      lock.release();
    }

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
        [...senders],
        env.GRAYMAIL_FOLDER,
      );

      if (updated !== script) {
        await sieve.putScript(env.SIEVE_SCRIPT_NAME, updated);
        console.log("[tick] Updated sieve script");
      } else {
        console.log("[tick] Sieve script already up to date");
      }

      await sieve.logout();
    } catch (err) {
      console.error("[tick] Sieve error:", err);
      sieve.destroy();
    }

    lock = await imap.getMailboxLock(env.INBOX_FOLDER);
    try {
      for (const sender of senders) {
        const found = await imap.search({ from: sender });
        if (!found || found.length === 0) continue;

        const toMove: number[] = [];
        for await (const msg of imap.fetch(found, { envelope: true })) {
          if (msg.envelope?.from?.[0]?.address?.toLowerCase() === sender) {
            toMove.push(msg.uid);
          }
        }

        if (toMove.length > 0) {
          await imap.messageMove(toMove, env.GRAYMAIL_FOLDER, {
            uid: true,
          });
          console.log(
            `[tick] Moved ${toMove.length} message(s) from ${sender} in INBOX to Graymail`,
          );
        }
      }
    } finally {
      lock.release();
    }

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
  console.log(`  Watching: ${env.GRAYMAIL_ADD_FOLDER}`);

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
