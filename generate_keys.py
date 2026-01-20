import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import uuid
import os

# --- IMPORTANT: This is the actual filename of your service account key file ---
# This file should be in the same directory as this script.
# You downloaded this from Firebase Console -> Project settings -> Service accounts
SERVICE_ACCOUNT_KEY_PATH = "aura-opt-admin-firebase-adminsdk-fbsvc-f894c9dcea.json" # <--- THIS IS NOW CORRECT

# Initialize Firebase Admin SDK
try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase Admin SDK initialized successfully.")
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}")
    print("Please ensure 'SERVICE_ACCOUNT_KEY_PATH' is correct and the file exists.")
    exit()

def generate_unique_key():
    """Generates a unique license key in the format AURA-XXXXX-XXXXX-XXXXX."""
    parts = [str(uuid.uuid4().hex[:5]).upper() for _ in range(3)]
    return f"AURA-{'-'.join(parts)}"

def upload_keys_to_firestore(num_keys=10):
    """Generates and uploads unique license keys to Firestore."""
    keys_collection_ref = db.collection('license_keys')
    
    print(f"\nGenerating and uploading {num_keys} unique license keys...")
    for i in range(num_keys):
        key = generate_unique_key()
        try:
            keys_collection_ref.document(key).set({
                'key': key,
                'isUsed': False,
                'usedByHwid': None,
                'activatedAt': None
            })
            print(f"Uploaded key {i+1}: {key}")
        except Exception as e:
            print(f"Error uploading key {key}: {e}")
    print(f"\nFinished uploading {num_keys} keys to 'license_keys' collection.")
    print("You can now find these keys in your Firebase Firestore console.")

if __name__ == "__main__":
    if not os.path.exists(SERVICE_ACCOUNT_KEY_PATH):
        print(f"Error: Service account key file not found at '{SERVICE_ACCOUNT_KEY_PATH}'")
        print("Please download it from Firebase Console -> Project settings -> Service accounts and update the path in the script.")
    else:
        upload_keys_to_firestore(10) # Generate 10 keys as requested