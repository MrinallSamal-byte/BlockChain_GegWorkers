import Foundation

// MARK: - Configuration

public struct VGDPConfig {
    public let apiBaseURL: URL
    public let environment: VGDPEnvironment
    public let zkArtifacts: VGDPZKArtifacts

    public init(apiBaseURL: URL, environment: VGDPEnvironment, zkArtifacts: VGDPZKArtifacts) {
        self.apiBaseURL = apiBaseURL
        self.environment = environment
        self.zkArtifacts = zkArtifacts
    }
}

public enum VGDPEnvironment {
    case amoy
    case polygon
}

public struct VGDPZKArtifacts {
    public let wasmName: String
    public let zkeyName: String
    public let verificationKeyName: String

    public static func bundled(
        wasmName: String,
        zkeyName: String,
        verificationKeyName: String
    ) -> VGDPZKArtifacts {
        VGDPZKArtifacts(
            wasmName: wasmName,
            zkeyName: zkeyName,
            verificationKeyName: verificationKeyName
        )
    }
}

// MARK: - Data Models

public struct VGDPDeliveryOrder {
    public let orderId: String
    public let companyId: String
    public let targetLatE7: Int32
    public let targetLonE7: Int32
    public let radiusMeters: UInt32
    public let riderDid: String
    public let riderWallet: String

    public init(
        orderId: String,
        companyId: String,
        targetLatE7: Int32,
        targetLonE7: Int32,
        radiusMeters: UInt32,
        riderDid: String,
        riderWallet: String
    ) {
        self.orderId = orderId
        self.companyId = companyId
        self.targetLatE7 = targetLatE7
        self.targetLonE7 = targetLonE7
        self.radiusMeters = radiusMeters
        self.riderDid = riderDid
        self.riderWallet = riderWallet
    }
}

public struct VGDPTrackingOptions {
    public let activationRadiusMeters: Double
    public let pollingIntervalSeconds: TimeInterval
    public let desiredAccuracyMeters: Double

    public init(
        activationRadiusMeters: Double = 200,
        pollingIntervalSeconds: TimeInterval = 5,
        desiredAccuracyMeters: Double = 10
    ) {
        self.activationRadiusMeters = activationRadiusMeters
        self.pollingIntervalSeconds = pollingIntervalSeconds
        self.desiredAccuracyMeters = desiredAccuracyMeters
    }
}

public struct VGDPProofResult {
    public let proofId: String
    public let transactionHash: String
    public let blockNumber: Int?
    public let merkleRoot: String
    public let status: String
}

// MARK: - Errors

public enum VGDPError: Error {
    case notImplemented
    case orderNotFound(String)
    case proofGenerationFailed(String)
    case apiError(Int, String)
    case locationUnavailable
    case configurationError(String)
}

// MARK: - Client

public final class VGDPClient {
    private let config: VGDPConfig
    private var activeOrders: [String: VGDPDeliveryOrder] = [:]
    private let session = URLSession.shared

    public init(config: VGDPConfig) {
        self.config = config
    }

    public func configureRiderIdentity(did: String, keyAlias: String) async throws {
        throw VGDPError.notImplemented
    }

    public func startTracking(
        order: VGDPDeliveryOrder,
        options: VGDPTrackingOptions = VGDPTrackingOptions()
    ) async throws {
        activeOrders[order.orderId] = order
        throw VGDPError.notImplemented
    }

    public func confirmDelivered(
        orderId: String,
        riderJWT: String,
        requirePhoto: Bool = true
    ) async throws -> VGDPProofResult {
        guard let order = activeOrders[orderId] else {
            throw VGDPError.orderNotFound(orderId)
        }
        let bundle = try await _buildProofBundle(order: order, riderJWT: riderJWT)
        return try await _submitBundle(bundle: bundle, riderJWT: riderJWT)
    }

    public func stopTracking(orderId: String) {
        activeOrders.removeValue(forKey: orderId)
    }

    // MARK: - Private

    private func _buildProofBundle(order: VGDPDeliveryOrder, riderJWT: String) async throws -> Data {
        throw VGDPError.notImplemented
    }

    private func _captureLocation() async throws -> (latE7: Int32, lonE7: Int32) {
        throw VGDPError.notImplemented
    }

    private func _capturePhoto() async throws -> Data {
        throw VGDPError.notImplemented
    }

    private func _computePhotoPHash(_ imageData: Data) throws -> Data {
        throw VGDPError.notImplemented
    }

    private func _generateZKProof(input: [String: String]) async throws -> Data {
        throw VGDPError.notImplemented
    }

    private func _signDigest(_ digest: Data) throws -> Data {
        throw VGDPError.notImplemented
    }

    private func _submitBundle(bundle: Data, riderJWT: String) async throws -> VGDPProofResult {
        var request = URLRequest(url: config.apiBaseURL.appendingPathComponent("proofs"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(riderJWT)", forHTTPHeaderField: "Authorization")
        request.httpBody = bundle

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw VGDPError.apiError(0, "Invalid response")
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw VGDPError.apiError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return VGDPProofResult(
            proofId: json?["proofId"] as? String ?? "",
            transactionHash: json?["transactionHash"] as? String ?? "",
            blockNumber: json?["blockNumber"] as? Int,
            merkleRoot: json?["merkleRoot"] as? String ?? "",
            status: json?["status"] as? String ?? ""
        )
    }
}
