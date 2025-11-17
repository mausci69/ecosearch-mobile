import secrets

def generate_key():
    # 32 bytes = 256-bit key, hex-encoded
    return secrets.token_hex(32)

if __name__ == "__main__":
    print(generate_key())

