// Controls your Windows PC using only built-in Windows tools (PowerShell,
// shutdown.exe, rundll32.exe). Nothing extra to install.
//
// Safety: values from the AI are never pasted into a command line. They are
// validated first (numbers 0-100, fixed action names, allow-listed app targets)
// and passed through environment variables that the scripts read.
import { execFile, spawn } from "node:child_process";

const PS = "powershell.exe"; // Windows PowerShell 5.1 (needed for the toast API)

// Core Audio COM interop: the standard way to read/set the master volume
// without third-party tools. The method order must match the Windows headers.
const VOLUME_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class PaiAudio {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    Guid epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
  }
}
'@
switch ($env:PAI_ACTION) {
  'set'    { [PaiAudio]::Volume = [single]([int]$env:PAI_LEVEL / 100.0) }
  'mute'   { [PaiAudio]::Mute = $true }
  'unmute' { [PaiAudio]::Mute = $false }
}
@{ volume = [int][math]::Round([PaiAudio]::Volume * 100); muted = [PaiAudio]::Mute } | ConvertTo-Json -Compress
`;

// Works for built-in laptop screens. Most external monitors can't be dimmed
// through Windows itself.
const BRIGHTNESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if ($env:PAI_ACTION -eq 'set') {
  Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods |
    Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$env:PAI_LEVEL } | Out-Null
}
$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness
@{ brightness = [int]$b } | ConvertTo-Json -Compress
`;

// Windows notification ("toast"), so reminders pop up even if the browser is closed.
const TOAST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode($env:PAI_TITLE)) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode($env:PAI_BODY)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

const SLEEP_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
`;

/** Built-in apps that are safe to open. Add your own in data/apps.json. */
export const DEFAULT_WINDOWS_APPS = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  paint: "mspaint.exe",
  "file explorer": "explorer.exe",
  "task manager": "taskmgr.exe",
  settings: "ms-settings:",
  "sound settings": "ms-settings:sound",
  "display settings": "ms-settings:display",
  "wifi settings": "ms-settings:network-wifi",
  "bluetooth settings": "ms-settings:bluetooth",
  edge: "microsoft-edge:",
  camera: "microsoft.windows.camera:",
  mail: "outlookmail:",
  calendar: "outlookcal:",
  spotify: "spotify:",
  whatsapp: "whatsapp:",
};

export function createWindowsSystem({ exec = execFile, spawnImpl = spawn } = {}) {
  function run(file, args, env = {}) {
    return new Promise((resolve, reject) => {
      exec(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim().split("\n")[0]));
        else resolve(String(stdout).trim());
      });
    });
  }
  const ps = (script, env) =>
    run(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], env);

  function launchDetached(file, args) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(file, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", (err) => reject(new Error(`Couldn't open "${file}": ${err.message}`)));
      child.once("spawn", () => { child.unref(); resolve(); });
    });
  }

  const level = (n) => String(Math.max(0, Math.min(100, Math.round(Number(n)))));

  return {
    supported: true,
    os: "windows",

    async volume(action, value) {
      if (!["get", "set", "mute", "unmute"].includes(action)) throw new Error(`Unknown volume action ${action}`);
      return JSON.parse(await ps(VOLUME_SCRIPT, { PAI_ACTION: action, PAI_LEVEL: level(value ?? 0) }));
    },

    async brightness(action, value) {
      try {
        const out = JSON.parse(await ps(BRIGHTNESS_SCRIPT, { PAI_ACTION: action, PAI_LEVEL: level(value ?? 0) }));
        return action === "set" ? { brightness: Number(level(value)) } : out;
      } catch {
        throw new Error("Brightness can only be changed on a built-in laptop screen. Most external monitors don't allow it from Windows.");
      }
    },

    async power(action) {
      const msg = "Personal AI: your PC will {x} in 30 seconds. Run 'shutdown /a' to cancel.";
      switch (action) {
        case "shutdown": return run("shutdown.exe", ["/s", "/t", "30", "/c", msg.replace("{x}", "shut down")]);
        case "restart": return run("shutdown.exe", ["/r", "/t", "30", "/c", msg.replace("{x}", "restart")]);
        case "cancel_shutdown": return run("shutdown.exe", ["/a"]);
        case "lock": return run("rundll32.exe", ["user32.dll,LockWorkStation"]);
        case "sleep": return ps(SLEEP_SCRIPT);
        default: throw new Error(`Unknown power action ${action}`);
      }
    },

    /** Opens an allow-listed app (exe path) or a URL / protocol link like ms-settings: */
    launch(target) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:\\/i.test(target)) {
        return launchDetached("rundll32.exe", ["url.dll,FileProtocolHandler", target]);
      }
      return launchDetached(target, []);
    },

    async notify(title, body) {
      await ps(TOAST_SCRIPT, { PAI_TITLE: String(title).slice(0, 100), PAI_BODY: String(body).slice(0, 300) });
    },
  };
}
