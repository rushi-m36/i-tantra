package com.rushi36.itantra

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class NsdDiscoveryModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val nsdManager = reactContext.getSystemService(Context.NSD_SERVICE) as NsdManager
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var registrationListener: NsdManager.RegistrationListener? = null
  private var registeredServiceName: String? = null
  private var serviceType = "_itantra._tcp."
  private var stopped = true

  override fun getName(): String = "NsdDiscovery"

  @ReactMethod
  fun start(deviceId: String, deviceName: String, port: Int) {
    stop()
    stopped = false

    val ownServiceName = "iTantra-${deviceId.takeLast(8)}"

    try {
      val serviceInfo = NsdServiceInfo().apply {
        serviceName = ownServiceName
        serviceType = this@NsdDiscoveryModule.serviceType
        this.port = port
      }

      val listener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {
          registeredServiceName = info.serviceName
        }
        override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
      }
      registrationListener = listener
      nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (_: Exception) {}

    try {
      val listener = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
          try { nsdManager.stopServiceDiscovery(this) } catch (_: Exception) {}
        }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onServiceLost(serviceInfo: NsdServiceInfo) {}

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          if (stopped) return
          val ownName = registeredServiceName ?: ownServiceName
          if (serviceInfo.serviceType != serviceType || serviceInfo.serviceName == ownName) return
          try {
            nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
              override fun onServiceResolved(info: NsdServiceInfo) {
                if (stopped) return
                val resolvedOwnName = registeredServiceName ?: ownServiceName
                if (info.serviceName == resolvedOwnName) return
                val host = info.host?.hostAddress ?: return
                if (info.port <= 0) return
                val params = Arguments.createMap().apply {
                  putString("serviceName", info.serviceName)
                  putString("host", host)
                  putInt("port", info.port)
                }
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                  .emit("itantraNsdDeviceFound", params)
              }
            })
          } catch (_: Exception) {}
        }
      }
      discoveryListener = listener
      nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun stop() {
    stopped = true
    discoveryListener?.let {
      try { nsdManager.stopServiceDiscovery(it) } catch (_: Exception) {}
    }
    discoveryListener = null

    registrationListener?.let {
      try { nsdManager.unregisterService(it) } catch (_: Exception) {}
    }
    registrationListener = null
    registeredServiceName = null
  }

  override fun invalidate() {
    stop()
    super.invalidate()
  }
}
