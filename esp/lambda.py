import boto3
import urllib.parse
import json
import logging
import os



CUSTOM_MODEL_ARN = os.environ['CUSTOM_MODEL_ARN']
IOT_ENDPOINT = "a5yjq0s3thy6p-ats.iot.ap-southeast-1.amazonaws.com"
# Default to accept one person
REFERENCE_BUCKET = "smart-house-4869"
REFERENCE_FOLDER = "door-access-images/references/"

logger = logging.getLogger()
logger.setLevel(logging.INFO)
rekognition = boto3.client('rekognition')
iot_client = boto3.client('iot-data', endpoint_url=f"https://{IOT_ENDPOINT}")
s3_client = boto3.client('s3')
def lambda_handler(event, context):
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(event['Records'][0]['s3']['object']['key'], encoding='utf-8')
    image_filename = key.split('/')[-1]
    # Get the mac address from the S3 object key
    try:
        mac_dashed = key.split('/')[1]
        mac_colons = mac_dashed.replace('-', ':')
    except:
        mac_colons = None

    if not mac_colons:
        return {
            'statusCode': 400,
            'body': json.dumps('Invalid MAC address format')
        }
    else:
        topic = f"smart-home/doors/{mac_colons}/command"
        is_authorized = False
    logger.info(f"Processing image: {image_filename}")
    try:
        logger.info(f"Calling to AWS Rekognition custom labels.")
        response = rekognition.detect_custom_labels(
            ProjectVersionArn=CUSTOM_MODEL_ARN,
            Image={'S3Object' : {'Bucket': bucket, 'Name': key}},
            MaxResults=10,
            MinConfidence=80.0
        )
        custom_labels = response.get('CustomLabels', [])
        logger.info(f"Data received from Custom Model: {json.dumps(custom_labels)}")


        live_faces_count = 0
        if len(custom_labels) <= 0:
            logger.info(f"No faces detected in the image {image_filename}. Access denied.")
            # publis to IoT topic to trigger door access denied
            # delete_s3_object(bucket, key)
            publish_mqtt(topic, False, "No face.")
            return {'statusCode': 403, 'body': 'No face.'}

        elif len(custom_labels) > 1:
            logger.info(f"Multiple faces detected in the image {image_filename}. Access denied.")
            # publis to IoT topic to trigger door access denied
            # delete_s3_object(bucket, key)
            publish_mqtt(topic, False, f"Multiple faces.")
            return {'statusCode': 403, 'body': 'Multiple faces detected.'}
            
        else:
            label_name = custom_labels[0].get('Name', '').lower()
            if label_name == 'live':
                live_faces_count = 1
                logger.info(f"Live face detected in the image {image_filename}.")
            else:
                logger.info(f"Non-live face detected in the image {image_filename}. Access denied.")
                # publis to IoT topic to trigger door access denied
                # delete_s3_object(bucket, key)
                publish_mqtt(topic, False, f"{label_name}!")
                return {'statusCode': 403, 'body': 'Non-live face detected.'}

        if live_faces_count == 1:
            logger.info(f"Proceeding to Rekognition to compare with `reference images in {image_filename}.")
            s3_list = s3_client.list_objects_v2(Bucket=REFERENCE_BUCKET, Prefix=REFERENCE_FOLDER)
            ref_files = [obj['Key'] for obj in s3_list.get('Contents', []) if obj['Key'] != REFERENCE_FOLDER]
            for ref_key in ref_files: 
                logger.info(f"Comparing with reference image: {ref_key}")
                compare_response = rekognition.compare_faces(
                    SourceImage={'S3Object' : {'Bucket': REFERENCE_BUCKET, 'Name': ref_key}},
                    TargetImage={'S3Object' : {'Bucket': bucket, 'Name': key}},
                    SimilarityThreshold=85.0
                )

                if(len(compare_response.get('FaceMatches', []))) > 0:
                    logger.info(f"Face match found with reference image: {ref_key}")
                    is_authorized = True
                    # Publish to IoT topic based on authorization result
                    logger.info(f"Authorized face detected in the image {image_filename}. Accepted")
                    # delete_s3_object(bucket, key)
                    publish_mqtt(topic, True, f"Authorized face.")
                    return {'statusCode': 200, 'body': 'Authorized.'}
                
            logger.info(f"Unauthorized face detected in the image {image_filename}. Access denied.")
            # Publish to IoT topic to trigger door access denied
            # delete_s3_object(bucket, key)
            publish_mqtt(topic, False, f"Unauthorized face.")
            return {'statusCode': 403, 'body': 'Unauthorized.'}

    except Exception as e:
        logger.error(f"Error system: {str(e)}")
        is_authorized = False
        # delete_s3_object(bucket, key)
        publish_mqtt(topic, False, f"Error processing image.")
        return {
            'statusCode': 500,
            'body': json.dumps('Error processing image')
        }
   
def delete_s3_object(bucket, key):
    try:
        s3_client.delete_object(Bucket=bucket, Key=key)
        logger.info(f"Deleted S3 object: {bucket}/{key}")
    except Exception as e:
        logger.error(f"Error deleting S3 object: {str(e)}")

def publish_mqtt(topic, is_authorized, message_text):
    payload = {
        'authorized': is_authorized,
        'message': message_text
    } 
    try:
        logger.info(f"Pushing to IOT topic: {topic} with payload: {json.dumps(payload)}")
        iot_client.publish(topic = topic,  qos = 1, payload = json.dumps(payload))
    except Exception as e:
        logger.error(f"Error publishing to IoT topic: {str(e)}")
