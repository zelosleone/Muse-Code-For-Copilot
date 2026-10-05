import * as vscode from 'vscode';
import { Auth } from './auth.js';
import { MuseChatProvider } from './provider.js';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Muse Code', { log: true });
  const auth = new Auth(context.secrets);
  const provider = new MuseChatProvider(context.globalState, auth, log);
  const timer = setInterval(() => void provider.refresh(), REFRESH_INTERVAL_MS);

  context.subscriptions.push(
    log,
    new vscode.Disposable(() => clearInterval(timer)),
    vscode.lm.registerLanguageModelChatProvider('muse-code', provider),
    auth.onDidChange(() => provider.sessionChanged()),
    vscode.commands.registerCommand('museCode.signIn', () => auth.signIn()),
    vscode.commands.registerCommand('museCode.signOut', () => auth.signOut()),
    vscode.commands.registerCommand('museCode.manage', () => manage(auth, provider, log)),
  );
  void provider.refresh();
}

async function manage(auth: Auth, provider: MuseChatProvider, log: vscode.LogOutputChannel): Promise<void> {
  const session = await auth.getSession();
  const actions: Record<string, () => unknown> = session
    ? { 'Refresh Models': () => provider.refresh(), 'Sign Out': () => auth.signOut() }
    : { 'Sign In': () => auth.signIn() };
  actions['Show Logs'] = () => log.show();
  const title = session ? `Muse Code: signed in${session.email ? ` as ${session.email}` : ''}` : 'Muse Code: signed out';
  const choice = await vscode.window.showQuickPick(Object.keys(actions), { title });
  if (choice) await actions[choice]();
}
