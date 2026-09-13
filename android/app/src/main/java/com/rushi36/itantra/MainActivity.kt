package com.rushi36.itantra

import expo.modules.splashscreen.SplashScreenManager

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private val backgroundServiceHandler = Handler(Looper.getMainLooper())
  private var backgroundServiceStartRunnable: Runnable? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
    handleIncomingCallIntent(intent)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
    }
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingCallIntent(intent)
  }

  private fun handleIncomingCallIntent(intent: Intent?) {
    if (intent?.data?.scheme != "itantra" || intent.data?.host != "incoming-call") return

    // Re-deliver the deep link to React Native after MainActivity is reused.
    // React Native/Expo can consume the activity intent through Linking.getInitialURL()
    // or the URL event depending on lifecycle timing.
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  override fun onResume() {
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    backgroundServiceStartRunnable = null
    stopBackgroundDiscoveryService()
    super.onResume()
  }

  override fun onPause() {
    super.onPause()
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    val runnable = Runnable {
      backgroundServiceStartRunnable = null
      startBackgroundDiscoveryService()
    }
    backgroundServiceStartRunnable = runnable
    // Give React Native AppState time to stop its foreground TCP server first.
    backgroundServiceHandler.postDelayed(runnable, 1200)
  }

  private fun startBackgroundDiscoveryService() {
    val intent = Intent(this, DiscoveryService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(intent)
      } else {
        startService(intent)
      }
    } catch (_: Exception) {
      // Android may reject a background service start in restricted states.
    }
  }

  private fun stopBackgroundDiscoveryService() {
    try {
      stopService(Intent(this, DiscoveryService::class.java))
    } catch (_: Exception) {
      // Service may already be stopped.
    }
  }

  override fun onDestroy() {
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    backgroundServiceStartRunnable = null
    super.onDestroy()
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {}
    )
  }

  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
