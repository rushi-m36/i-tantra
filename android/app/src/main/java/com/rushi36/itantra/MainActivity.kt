package com.rushi36.itantra

import expo.modules.splashscreen.SplashScreenManager

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private val backgroundServiceHandler = Handler(Looper.getMainLooper())
  private var backgroundServiceStartRunnable: Runnable? = null
  private val TAG = "iTantraMainActivity"

  override fun onCreate(savedInstanceState: Bundle?) {
    Log.d(TAG, "[MAIN 1] onCreate ENTER intent=${intent?.action} data=${intent?.data} flags=${intent?.flags}")
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
    Log.d(TAG, "[MAIN 2] ReactActivity onCreate completed")
    handleIncomingCallIntent(intent)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      Log.d(TAG, "[MAIN] Requesting POST_NOTIFICATIONS permission")
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
    }
  }

  override fun onNewIntent(intent: Intent?) {
    Log.d(TAG, "[MAIN 3] onNewIntent ENTER action=${intent?.action} data=${intent?.data} flags=${intent?.flags}")
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingCallIntent(intent)
    Log.d(TAG, "[MAIN 4] onNewIntent EXIT; getIntent data=${getIntent()?.data}")
  }

  private fun handleIncomingCallIntent(intent: Intent?) {
    Log.d(TAG, "[MAIN LINK] handleIncomingCallIntent action=${intent?.action} data=${intent?.data} scheme=${intent?.data?.scheme} host=${intent?.data?.host}")
    if (intent?.data?.scheme != "itantra" || intent.data?.host != "incoming-call") {
      Log.d(TAG, "[MAIN LINK] Not an incoming-call deep link")
      return
    }
    Log.d(TAG, "[MAIN LINK] INCOMING CALL DEEP LINK DETECTED ip=${intent.data?.getQueryParameter("ip")} name=${intent.data?.getQueryParameter("name")}")
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  override fun onResume() {
    Log.d(TAG, "[MAIN LIFE] onResume - stopping background DiscoveryService")
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    backgroundServiceStartRunnable = null
    stopBackgroundDiscoveryService()
    super.onResume()
  }

  override fun onPause() {
    Log.d(TAG, "[MAIN LIFE] onPause - scheduling background DiscoveryService in 1200ms")
    super.onPause()
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    val runnable = Runnable {
      backgroundServiceStartRunnable = null
      Log.d(TAG, "[MAIN LIFE] Background-service delay elapsed; starting DiscoveryService")
      startBackgroundDiscoveryService()
    }
    backgroundServiceStartRunnable = runnable
    backgroundServiceHandler.postDelayed(runnable, 1200)
  }

  private fun startBackgroundDiscoveryService() {
    Log.d(TAG, "[MAIN SERVICE] startBackgroundDiscoveryService()")
    val intent = Intent(this, DiscoveryService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
      Log.d(TAG, "[MAIN SERVICE] DiscoveryService start request returned successfully")
    } catch (e: Exception) {
      Log.e(TAG, "[MAIN SERVICE] DiscoveryService start FAILED", e)
    }
  }

  private fun stopBackgroundDiscoveryService() {
    try {
      val stopped = stopService(Intent(this, DiscoveryService::class.java))
      Log.d(TAG, "[MAIN SERVICE] stopBackgroundDiscoveryService result=$stopped")
    } catch (e: Exception) {
      Log.e(TAG, "[MAIN SERVICE] stopBackgroundDiscoveryService FAILED", e)
    }
  }

  override fun onDestroy() {
    Log.d(TAG, "[MAIN LIFE] onDestroy")
    backgroundServiceStartRunnable?.let { backgroundServiceHandler.removeCallbacks(it) }
    backgroundServiceStartRunnable = null
    super.onDestroy()
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {})
  }

  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) super.invokeDefaultOnBackPressed()
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
