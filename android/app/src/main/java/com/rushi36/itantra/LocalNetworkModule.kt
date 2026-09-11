package com.rushi36.itantra

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
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
      val addresses = linkedSetOf<String>()
      val connectivityManager = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

      // ConnectivityManager/LinkProperties is the reliable Android API for
      // discovering addresses attached to the currently available networks.
      // This also works better than NetworkInterface on devices using hotspot
      // or tethering interfaces.
      try {
        for (network: Network in connectivityManager.allNetworks) {
          val capabilities: NetworkCapabilities = connectivityManager.getNetworkCapabilities(network) ?: continue
          val linkProperties: LinkProperties = connectivityManager.getLinkProperties(network) ?: continue

          for (linkAddress in linkProperties.linkAddresses) {
            val address = linkAddress.address
            if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
              val ip = address.hostAddress
              if (!ip.isNullOrBlank()) addresses.add(ip)
            }
          }
        }
      } catch (_: Exception) {
        // Fall through to NetworkInterface below.
      }

      // Fallback for Android versions/devices where LinkProperties does not
      // expose an address for the tethering interface.
      if (addresses.isEmpty()) {
        try {
          val interfaces = NetworkInterface.getNetworkInterfaces()
          while (interfaces.hasMoreElements()) {
            val networkInterface = interfaces.nextElement()
            try {
              if (!networkInterface.isUp || networkInterface.isLoopback) continue
              val interfaceAddresses = networkInterface.inetAddresses
              while (interfaceAddresses.hasMoreElements()) {
                val address = interfaceAddresses.nextElement()
                if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
                  val ip = address.hostAddress
                  if (!ip.isNullOrBlank()) addresses.add(ip)
                }
              }
            } catch (_: Exception) {
              // Ignore one problematic interface and continue with others.
            }
          }
        } catch (_: Exception) {
          // Return an empty list; JavaScript has its own fallbacks.
        }
      }

      val result = Arguments.createArray()
      for (address in addresses) result.pushString(address)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("LOCAL_NETWORK_ERROR", "Failed to enumerate local IPv4 addresses", e)
    }
  }
}
