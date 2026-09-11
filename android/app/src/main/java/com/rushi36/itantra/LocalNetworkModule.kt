package com.rushi36.itantra

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.Inet4Address
import java.net.NetworkInterface

class LocalNetworkModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "LocalNetwork"

  @ReactMethod
  fun getLocalIPv4Addresses(promise: Promise) {
    try {
      val addresses = mutableListOf<String>()
      val interfaces = NetworkInterface.getNetworkInterfaces()

      while (interfaces.hasMoreElements()) {
        val networkInterface = interfaces.nextElement()
        if (!networkInterface.isUp || networkInterface.isLoopback) continue

        val interfaceAddresses = networkInterface.inetAddresses
        while (interfaceAddresses.hasMoreElements()) {
          val address = interfaceAddresses.nextElement()
          if (address is Inet4Address && !address.isLoopbackAddress) {
            val ip = address.hostAddress
            if (!ip.isNullOrBlank() && !addresses.contains(ip)) {
              addresses.add(ip)
            }
          }
        }
      }

      promise.resolve(addresses)
    } catch (e: Exception) {
      promise.reject("LOCAL_NETWORK_ERROR", "Failed to enumerate local IPv4 addresses", e)
    }
  }
}
