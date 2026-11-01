// electron-builder "afterPack" hook: VMP-signs the packaged app with castLabs EVS.
//
// Why: Spotify and Apple Music use Widevine DRM. Widevine only gives full-quality
// licenses to apps with a valid "Verified Media Path" (VMP) signature. castLabs
// signs apps for free through their EVS service (you need a free account).
//
// Credentials, in order of preference:
//   1. EVS_ACCOUNT_NAME and EVS_PASSWD environment variables (used by GitHub Actions)
//   2. A local login you did once with:  python -m castlabs_evs.account reauth
//
// Set VMP_REQUIRED=1 to make the build fail if signing fails (the release workflow does).

const { execFileSync } = require('child_process');

exports.default = async function vmpSign(context) {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const args = ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg'];

  if (process.env.EVS_ACCOUNT_NAME && process.env.EVS_PASSWD) {
    args.push('-A', process.env.EVS_ACCOUNT_NAME, '-P', process.env.EVS_PASSWD);
  }
  args.push(context.appOutDir);

  console.log(`  • VMP-signing ${context.appOutDir}`);
  try {
    execFileSync(python, args, { stdio: 'inherit' });
    execFileSync(python, ['-m', 'castlabs_evs.vmp', '-n', 'verify-pkg', context.appOutDir], {
      stdio: 'inherit'
    });
    console.log('  • VMP signature OK');
  } catch (err) {
    const msg =
      'VMP signing failed. The app will still run, but Spotify/Apple Music may refuse to play. ' +
      'See the "VMP signing" section of the README.';
    if (process.env.VMP_REQUIRED === '1') throw new Error(msg);
    console.warn(`  ⚠ ${msg}`);
  }
};
