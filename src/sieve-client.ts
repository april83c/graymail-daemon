import * as net from "net";
import * as tls from "tls";

export class SieveClient {
  private socket!: net.Socket | tls.TLSSocket;
  private buffer = Buffer.alloc(0);
  private waiter: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  async connect(
    host: string,
    port: number,
    security: "starttls" | "tls" | "none",
  ): Promise<void> {
    const useTls = security === "tls";
    const socket = await new Promise<net.Socket | tls.TLSSocket>(
      (resolve, reject) => {
        let s: net.Socket | tls.TLSSocket;
        if (useTls) {
          s = tls.connect({ host, port }, () => resolve(s));
        } else {
          s = net.connect({ host, port }, () => resolve(s));
        }
        s.on("error", reject);
      },
    );

    this.attachSocket(socket);
    await this.readResponse();

    if (security === "starttls") {
      await this.starttls(host);
    }
  }

  private attachSocket(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);

    this.socket.on("data", (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve();
      }
    });

    this.socket.on("error", (err: Error) => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.reject(err);
      }
    });

    this.socket.on("close", () => {
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.reject(new Error("ManageSieve: connection closed"));
      }
    });
  }

  private waitForData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error("ManageSieve: timeout waiting for data"));
      }, 30_000);

      this.waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = this.buffer.subarray(0, idx).toString("utf-8");
        this.buffer = this.buffer.subarray(idx + 2);
        return line;
      }
      await this.waitForData();
    }
  }

  private async readBytes(n: number): Promise<Buffer> {
    while (this.buffer.length < n) {
      await this.waitForData();
    }
    const result = Buffer.from(this.buffer.subarray(0, n));
    this.buffer = this.buffer.subarray(n);
    return result;
  }

  private async readResponse(): Promise<{
    lines: string[];
    literals: Buffer[];
  }> {
    const lines: string[] = [];
    const literals: Buffer[] = [];

    while (true) {
      const line = await this.readLine();

      const literalMatch = line.match(/\{(\d+)\+?\}\s*$/);
      if (literalMatch) {
        const size = parseInt(literalMatch[1]);
        const data = await this.readBytes(size);
        literals.push(data);
        lines.push(line);
        continue;
      }

      if (/^OK\b/.test(line)) {
        return { lines, literals };
      }
      if (/^NO\b/.test(line)) {
        throw new Error(`ManageSieve: ${line}`);
      }
      if (/^BYE\b/.test(line)) {
        throw new Error(`ManageSieve disconnected: ${line}`);
      }

      lines.push(line);
    }
  }

  private async starttls(host: string): Promise<void> {
    this.socket.write("STARTTLS\r\n");
    await this.readResponse();

    this.socket.removeAllListeners();

    const tlsSocket = tls.connect({
      socket: this.socket as net.Socket,
      servername: host,
    });

    await new Promise<void>((resolve, reject) => {
      tlsSocket.once("secureConnect", resolve);
      tlsSocket.once("error", reject);
    });

    this.attachSocket(tlsSocket);
    await this.readResponse();
  }

  async authenticate(user: string, pass: string): Promise<void> {
    const token = Buffer.from(`\0${user}\0${pass}`).toString("base64");
    this.socket.write(`AUTHENTICATE "PLAIN" "${token}"\r\n`);
    await this.readResponse();
  }

  async getScript(name: string): Promise<string> {
    this.socket.write(`GETSCRIPT "${name}"\r\n`);
    const resp = await this.readResponse();
    if (resp.literals.length === 0) {
      throw new Error("ManageSieve: GETSCRIPT returned no data");
    }
    return resp.literals[0].toString("utf-8");
  }

  async putScript(name: string, content: string): Promise<void> {
    const buf = Buffer.from(content, "utf-8");
    this.socket.write(`PUTSCRIPT "${name}" {${buf.length}+}\r\n`);
    this.socket.write(buf);
    this.socket.write("\r\n");
    await this.readResponse();
  }

  async logout(): Promise<void> {
    this.socket.write("LOGOUT\r\n");
    try {
      await this.readResponse();
    } catch {
      // BYE is expected
    }
    this.socket.destroy();
  }

  destroy(): void {
    this.socket?.destroy();
  }
}
