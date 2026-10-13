@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto nonode
if "%JAVA_HOME%"=="" goto nojava
if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" goto nosdk
call npm install
if errorlevel 1 goto err
call node scripts\prepare-web.js
if errorlevel 1 goto err
if not exist android call npx cap add android
if errorlevel 1 goto err
call node scripts\patch-android.js
if errorlevel 1 goto err
call npx cap sync android
if errorlevel 1 goto err
pushd android
call gradlew.bat assembleDebug
if errorlevel 1 goto err2
popd
copy /y android\app\build\outputs\apk\debug\app-debug.apk EngineSim.apk
echo.
echo DONE: EngineSim.apk - copy it to the phone and install
pause
exit /b 0
:nonode
echo Install Node.js 18+ from https://nodejs.org
goto fail
:nojava
echo JAVA_HOME is not set. Install JDK 17 Temurin and set JAVA_HOME. JDK 21 does not work with this Gradle.
goto fail
:nosdk
echo Android SDK not found. Install Android Studio and set ANDROID_HOME. Or use the GitHub Actions way from README.
goto fail
:err2
popd
:err
echo BUILD ERROR - see messages above
:fail
pause
exit /b 1
