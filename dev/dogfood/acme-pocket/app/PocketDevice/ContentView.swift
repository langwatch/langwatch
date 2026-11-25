import SwiftUI
import CoreBluetooth

struct ContentView: View {
    @StateObject var central = BluetoothCentral()

    var body: some View {
        VStack {
            Text(central.connected ? "Connected" : "Searching...")
            Button("Ping") { central.ping() }
        }
    }
}
