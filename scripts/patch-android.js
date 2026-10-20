// Правки сгенерированного Capacitor-проекта: альбомная ориентация, полный экран, экран не гаснет.
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const man = path.join(base, 'AndroidManifest.xml'); let x = fs.readFileSync(man, 'utf8');
if (!x.includes('screenOrientation')) x = x.replace('<activity', '<activity android:screenOrientation="sensorLandscape"');
if (!x.includes('android.permission.VIBRATE')) x = x.replace('<application', '<uses-permission android:name="android.permission.VIBRATE" />\n    <application');   // вибрация (navigator.vibrate)
fs.writeFileSync(man, x);
// иконка приложения: PNG разных размеров вместо адаптивной иконки по умолчанию
const res = path.join(base, 'res'), src = path.join(__dirname, '..', 'android-res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
for (const d of fs.readdirSync(src)) { fs.mkdirSync(path.join(res, d), { recursive: true }); for (const f of fs.readdirSync(path.join(src, d))) fs.copyFileSync(path.join(src, d, f), path.join(res, d, f)); }
const dir = path.join(base, 'java', 'com', 'enginesim', 'app'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'MainActivity.java'), `package com.enginesim.app;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    hideBars();
  }
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideBars();
  }
  private void hideBars() {
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
}
`);
console.log('android: патч применён');
