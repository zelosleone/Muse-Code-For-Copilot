import * as vscode from 'vscode';
import { mintSession, pollAccessToken, requestDeviceCode, type Session } from './meta.js';

const SESSION_KEY = 'museCode.session';

export class Auth {
  private signingIn?: Promise<void>;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getSession(): Promise<Session | undefined> {
    const stored = await this.secrets.get(SESSION_KEY);
    return stored ? (JSON.parse(stored) as Session) : undefined;
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return this.secrets.onDidChange((event) => {
      if (event.key === SESSION_KEY) listener();
    });
  }

  signIn(): Promise<void> {
    this.signingIn ??= this.runSignIn().finally(() => {
      this.signingIn = undefined;
    });
    return this.signingIn;
  }

  async signOut(): Promise<void> {
    await this.secrets.delete(SESSION_KEY);
  }

  private async runSignIn(): Promise<void> {
    try {
      const session = await this.authorize();
      await this.secrets.store(SESSION_KEY, JSON.stringify(session));
      void vscode.window.showInformationMessage(`Signed in to Muse Code${session.email ? ` as ${session.email}` : ''}.`);
    } catch (error) {
      if (!(error instanceof vscode.CancellationError)) {
        void vscode.window.showErrorMessage(`Muse Code sign-in failed: ${(error as Error).message}`);
      }
    }
  }

  private async authorize(): Promise<Session> {
    const device = await requestDeviceCode();
    await vscode.env.clipboard.writeText(device.user_code);
    await vscode.env.openExternal(vscode.Uri.parse(device.verification_uri_complete ?? device.verification_uri));
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Muse Code: enter code ${device.user_code} at ${device.verification_uri} (copied)`,
        cancellable: true,
      },
      async (_progress, cancel) => mintSession(await pollAccessToken(device, cancel)),
    );
  }
}
