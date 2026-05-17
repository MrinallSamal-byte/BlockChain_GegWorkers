// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VGDP",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(name: "VGDP", targets: ["VGDP"])
    ],
    dependencies: [],
    targets: [
        .target(
            name: "VGDP",
            path: "Sources/VGDP"
        ),
        .testTarget(
            name: "VGDPTests",
            dependencies: ["VGDP"],
            path: "Tests/VGDPTests"
        )
    ]
)
